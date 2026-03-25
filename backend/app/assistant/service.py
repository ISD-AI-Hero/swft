from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterable, Iterator
from uuid import uuid4

from httpx import TimeoutException
from openai import (
    APIConnectionError,
    APIStatusError,
    BadRequestError,
    OpenAIError,
    RateLimitError,
    OpenAI,
    AzureOpenAI,
)

try:
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
except ImportError:
    DefaultAzureCredential = None  # type: ignore[assignment,misc]
    get_bearer_token_provider = None  # type: ignore[assignment]

from ..core.cache import SimpleTTLCache, create_cache
from ..core.config import get_settings
from ..services.catalog import ArtifactCatalogService, create_catalog
from .config import AssistantSettings, ModelDescriptor, Provider, get_assistant_settings
from .models import (
    AssistantConfig,
    AssistantMetadata,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    Facet,
    Persona,
    ModelOption,
)
from .prompts import build_system_prompt
from .schemas import get_schema_bundle

logger = logging.getLogger(__name__)

APP_DESIGN_PATH = Path("app-design.md")
_app_design_cache: SimpleTTLCache = create_cache(max_items=1, ttl_seconds=120)


def _load_repo_app_design() -> str:
    """Read app-design.md from the local workspace with a short-lived cache."""
    key = "app_design"
    if key in _app_design_cache:
        return _app_design_cache[key]
    if not APP_DESIGN_PATH.exists():
        text = "app-design.md not found. Populate this file with architecture guidance."
    else:
        text = APP_DESIGN_PATH.read_text(encoding="utf-8")
    _app_design_cache[key] = text
    return text


class ConversationStore:
    """Ephemeral in-memory store with TTL expiry for chat history."""

    def __init__(self, ttl_seconds: int, max_items: int):
        self._cache = create_cache(max_items=max_items, ttl_seconds=ttl_seconds)

    def load(self, conversation_id: str) -> list[ChatMessage]:
        try:
            return list(self._cache[conversation_id])
        except KeyError:
            return []

    def persist(self, conversation_id: str, history: Iterable[ChatMessage]) -> None:
        self._cache[conversation_id] = list(history)


def _message_payload(role: str, content: str) -> dict[str, object]:
    content_type = "output_text" if role == "assistant" else "input_text"
    return {
        "role": role,
        "content": [{"type": content_type, "text": content}],
    }


class AssistantService:
    """High-level façade orchestrating prompt assembly and model calls."""

    def __init__(self, settings: AssistantSettings | None = None, catalog: ArtifactCatalogService | None = None):
        self._settings = settings or get_assistant_settings()
        self._provider_cfg = self._settings.provider_config()
        self._client: OpenAI | AzureOpenAI | None = None
        self._history = ConversationStore(
            ttl_seconds=self._settings.history_ttl_seconds,
            max_items=self._settings.history_max_items,
        )
        if catalog is None:
            try:
                catalog = create_catalog(get_settings())
            except Exception as exc:  # pragma: no cover - defensive guardrail
                logger.warning("Unable to initialise artifact catalog for assistant: %s", exc)
                catalog = None
        self._catalog: ArtifactCatalogService | None = catalog

    def _build_client(self, provider: Provider) -> OpenAI | AzureOpenAI:
        if provider == "azure":
            if not self._settings.api_base:
                raise ValueError("OPENAI_API_BASE must be set for Azure OpenAI.")
            if not self._settings.api_version:
                raise ValueError("OPENAI_API_VERSION must be set for Azure OpenAI.")

            # Prefer managed identity (no secrets); fall back to API key.
            if self._settings.use_managed_identity:
                if DefaultAzureCredential is None or get_bearer_token_provider is None:
                    raise ValueError(
                        "azure-identity package is required for managed identity auth. "
                        "Install it with: pip install azure-identity"
                    )
                credential = DefaultAzureCredential()
                token_provider = get_bearer_token_provider(
                    credential, "https://cognitiveservices.azure.com/.default"
                )
                return AzureOpenAI(
                    azure_ad_token_provider=token_provider,
                    azure_endpoint=self._settings.api_base,
                    api_version=self._settings.api_version,
                )

            if not self._settings.api_key:
                raise ValueError("Assistant is not configured. Set OPENAI_API_KEY or enable OPENAI_USE_MANAGED_IDENTITY.")
            return AzureOpenAI(
                api_key=self._settings.api_key,
                azure_endpoint=self._settings.api_base,
                api_version=self._settings.api_version,
            )

        # Non-Azure OpenAI provider
        if not self._settings.api_key:
            raise ValueError("Assistant is not configured. Set OPENAI_API_KEY in the backend environment.")
        return OpenAI(
            api_key=self._settings.api_key,
            base_url=self._settings.api_base,
            organization=self._settings.organization,
        )

    def _ensure_client(self) -> OpenAI | AzureOpenAI:
        if self._client is not None:
            return self._client
        self._client = self._build_client(self._settings.provider)
        return self._client

    def _select_history(self, request: ChatRequest, conversation_id: str) -> list[ChatMessage]:
        stored_history = self._history.load(conversation_id)
        if request.history:
            # Merge caller-supplied history with existing entries, preferring stored records first.
            stored_history = stored_history + list(request.history)
        depth = request.history_depth
        if depth == "all":
            return stored_history
        count = int(depth)
        if count <= 0:
            return []
        return stored_history[-count:]

    def _build_messages(self, request: ChatRequest, conversation_id: str) -> tuple[list[dict[str, object]], list[ChatMessage]]:
        schema_bundle = get_schema_bundle(request.facet)
        app_design = self._resolve_app_design(request)
        system_prompt = build_system_prompt(
            persona=request.persona,
            facet=request.facet,
            app_design=app_design,
            schemas=schema_bundle,
            context=request.context or None,
        )
        messages = [_message_payload("system", system_prompt)]
        history = self._select_history(request, conversation_id)
        for item in history:
            messages.append(_message_payload(item.role, item.content))
        user_message = ChatMessage(role="user", content=request.question)
        messages.append(_message_payload("user", request.question))
        updated_history = history + [ChatMessage(role="user", content=request.question)]
        return messages, updated_history

    def _invoke_model(self, messages: list[dict[str, object]], model_descriptor: ModelDescriptor, provider: Provider):
        model_identifier = model_descriptor.resolve_identifier(provider)
        request_kwargs = {
            "model": model_identifier,
            "input": messages,
        }
        if descriptor.max_output_tokens:
            request_kwargs["max_output_tokens"] = descriptor.max_output_tokens
        client = self._ensure_client()
        try:
            response = client.responses.create(**request_kwargs)
        except RateLimitError as exc:
            logger.warning("Rate limit from provider %s: %s", provider, exc)
            raise
        except (APIConnectionError, TimeoutException) as exc:
            logger.error("Connectivity issue reaching provider %s: %s", provider, exc)
            raise
        except APIStatusError as exc:
            logger.error("Provider %s returned %s: %s", provider, exc.status_code, exc.message)
            raise
        except (BadRequestError, OpenAIError) as exc:
            logger.exception("Unexpected error invoking model")
            raise
        return response

    @staticmethod
    def _extract_text(response) -> str:
        segments: list[str] = []
        try:
            for item in getattr(response, "output", []) or []:
                for content in getattr(item, "content", []) or []:
                    if getattr(content, "type", None) == "output_text":
                        segments.append(content.text)
        except AttributeError:
            pass
        text = "".join(segments).strip()
        if not text:
            # Fallback to raw serialization.
            text = str(response)
        return text

    def _resolve_app_design(self, request: ChatRequest) -> str:
        """Load the best available app-design.md context for this request."""
        if request.project_id and request.run_id and self._catalog:
            try:
                design = self._catalog.load_app_design(request.project_id, request.run_id)
                if design:
                    return design
            except Exception:
                logger.exception("Failed to load app-design.md for %s/%s", request.project_id, request.run_id)
        # Disable repo fallback so missing Azure blobs are obvious during testing.
        return "app-design.md not found in Azure Storage for this run. Confirm the workflow upload succeeded."

    def generate(self, request: ChatRequest) -> ChatResponse:
        provider = self._settings.provider
        model_key, descriptor = self._provider_cfg.get_model(request.selected_model)
        conversation_id = request.conversation_id or uuid4().hex
        messages, history_with_user = self._build_messages(request, conversation_id)
        history_count = max(len(history_with_user) - 1, 0)

        try:
            response = self._invoke_model(messages, descriptor, provider)
        except RateLimitError as exc:
            raise RuntimeError("Rate limit exceeded. Please retry shortly or choose a different model.") from exc
        except APIConnectionError as exc:
            raise RuntimeError("Unable to reach the OpenAI endpoint. Check network connectivity and try again.") from exc
        except TimeoutException as exc:
            raise RuntimeError("OpenAI endpoint timed out. Please retry.") from exc
        except APIStatusError as exc:
            raise RuntimeError(f"OpenAI returned an error ({exc.status_code}): {exc.message}") from exc
        except (BadRequestError, OpenAIError) as exc:
            raise RuntimeError(f"OpenAI request failed: {exc}") from exc

        answer_text = self._extract_text(response)
        # Append assistant reply to history.
        full_history = history_with_user + [ChatMessage(role="assistant", content=answer_text)]
        self._history.persist(conversation_id, full_history)

        metadata = AssistantMetadata(
            provider=provider,
            model_key=model_key,
            model_identifier=descriptor.resolve_identifier(provider),
            persona=request.persona,
            facet=request.facet,
            history_included=history_count,
            max_output_tokens=descriptor.max_output_tokens,
            max_input_tokens=descriptor.max_input_tokens,
            total_context_window=descriptor.total_context_window,
        )
        return ChatResponse(answer=answer_text, conversation_id=conversation_id, metadata=metadata)

    def stream(self, request: ChatRequest) -> Iterator[bytes]:
        provider = self._settings.provider
        model_key, descriptor = self._provider_cfg.get_model(request.selected_model)
        conversation_id = request.conversation_id or uuid4().hex
        messages, history_with_user = self._build_messages(request, conversation_id)
        history_count = max(len(history_with_user) - 1, 0)
        model_identifier = descriptor.resolve_identifier(provider)
        metadata = AssistantMetadata(
            provider=provider,
            model_key=model_key,
            model_identifier=model_identifier,
            persona=request.persona,
            facet=request.facet,
            history_included=history_count,
            max_output_tokens=descriptor.max_output_tokens,
            max_input_tokens=descriptor.max_input_tokens,
            total_context_window=descriptor.total_context_window,
        )

        client = self._ensure_client()

        def json_line(payload: dict[str, object]) -> bytes:
            return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")

        yield json_line(
            {
                "type": "metadata",
                "conversation_id": conversation_id,
                "metadata": metadata.model_dump(mode="json"),
            }
        )

        accumulator: list[str] = []
        final_response = None
        try:
            stream_kwargs = {
                "model": model_identifier,
                "input": messages,
            }
            if descriptor.max_output_tokens:
                stream_kwargs["max_output_tokens"] = descriptor.max_output_tokens
            with client.responses.stream(**stream_kwargs) as stream:
                for event in stream:
                    event_type = getattr(event, "type", "")
                    if event_type == "response.output_text.delta":
                        delta = getattr(event, "delta", "")
                        if delta:
                            accumulator.append(delta)
                            yield json_line({"type": "delta", "delta": delta})
                    elif event_type == "response.refusal.delta":
                        delta = getattr(event, "delta", "")
                        if delta:
                            accumulator.append(delta)
                            yield json_line({"type": "delta", "delta": delta})
                final_response = stream.get_final_response()
        except RateLimitError:
            logger.exception("OpenAI streaming rate limit exceeded")
            yield json_line({"type": "error", "error": "Rate limit exceeded. Please retry shortly or choose a different model."})
            return
        except APIConnectionError:
            logger.exception("OpenAI streaming connection error")
            yield json_line({"type": "error", "error": "Unable to reach the OpenAI endpoint. Check network connectivity and try again."})
            return
        except TimeoutException:
            logger.exception("OpenAI streaming request timed out")
            yield json_line({"type": "error", "error": "OpenAI endpoint timed out. Please retry."})
            return
        except APIStatusError as exc:
            logger.exception("OpenAI streaming returned API status error %s", getattr(exc, "status_code", "unknown"))
            yield json_line({"type": "error", "error": f"OpenAI returned an error ({exc.status_code})."})
            return
        except (BadRequestError, OpenAIError):
            logger.exception("OpenAI streaming request failed")
            yield json_line({"type": "error", "error": "OpenAI request failed. Please try again later."})
            return

        final_text = "".join(accumulator).strip()
        if not final_text and final_response is not None:
            final_text = self._extract_text(final_response)
        full_history = history_with_user + [ChatMessage(role="assistant", content=final_text)]
        self._history.persist(conversation_id, full_history)
        yield json_line(
            {
                "type": "final",
                "conversation_id": conversation_id,
                "answer": final_text,
                "metadata": metadata.model_dump(mode="json"),
            }
        )

    def configuration(self) -> AssistantConfig:
        models = [
            ModelOption(
                key=key,
                label=key.replace("_", " ").title(),
                response_format=descriptor.response_format,
                total_context_window=descriptor.total_context_window,
                max_input_tokens=descriptor.max_input_tokens,
                max_output_tokens=descriptor.max_output_tokens,
            )
            for key, descriptor in self._provider_cfg.models.items()
        ]
        return AssistantConfig(
            provider=self._settings.provider,
            models=models,
            personas=list(Persona),
            facets=list(Facet),
            history_depths=[0, 2, 5, 7, 10, 15, "all"],
            streaming_enabled=True,
        )
