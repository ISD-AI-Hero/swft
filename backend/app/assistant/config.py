from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator, PrivateAttr
from pydantic_settings import BaseSettings, SettingsConfigDict
import json


Provider = Literal["azure", "openai"]
DEFAULT_MODEL_CONFIG_PATH = Path(__file__).resolve().parent / "model_config.json"

# Default limits to use when a model definition omits token settings
DEFAULT_MODEL_LIMITS: dict[str, dict[str, int]] = {
    "gpt-4o": {
        "total_context_window": 128_000,
        "max_output_tokens": 4_000,
        "max_input_tokens": 124_000,
    },
    "gpt-4o-mini": {
        "total_context_window": 128_000,
        "max_output_tokens": 16_384,
        "max_input_tokens": 111_616,
    },
    "gpt-5": {
        "total_context_window": 400_000,
        "max_output_tokens": 128_000,
        "max_input_tokens": 272_000,
    },
    "gpt-5-mini": {
        "total_context_window": 400_000,
        "max_output_tokens": 128_000,
        "max_input_tokens": 272_000,
    },
    "gpt-5-nano": {
        "total_context_window": 400_000,
        "max_output_tokens": 128_000,
        "max_input_tokens": 272_000,
    },
    "gpt-4.1": {
        "total_context_window": 128_000,
        "max_output_tokens": 4_000,
        "max_input_tokens": 124_000,
    },
}


class ModelDescriptor(BaseModel):
    """Describes a single model entry declared in model_config.json."""

    model: str | None = Field(default=None, description="Model identifier for non-Azure providers.")
    deployment: str | None = Field(default=None, description="Azure OpenAI deployment name.")
    response_format: Literal["json", "text"] | None = Field(default=None, description="Preferred response format for the model.")
    total_context_window: int | None = Field(default=None, ge=1, description="Maximum total tokens (input + output) the model supports.")
    max_output_tokens: int | None = Field(default=None, ge=1, description="Maximum number of tokens the model may output.")
    max_input_tokens: int | None = Field(default=None, ge=1, description="Maximum number of tokens allowed for the prompt portion.")

    @model_validator(mode="after")
    def validate_identifier(self) -> "ModelDescriptor":
        if not self.model and not self.deployment:
            raise ValueError("Model entries must define either 'model' or 'deployment'.")
        return self

    def resolve_identifier(self, provider: Provider) -> str:
        """Return the identifier that should be passed to the OpenAI SDK."""
        if provider == "azure":
            if not self.deployment:
                raise ValueError("Azure model entries must define a 'deployment'.")
            return self.deployment
        if not self.model:
            raise ValueError("OpenAI model entries must define a 'model'.")
        return self.model


class ProviderModelConfig(BaseModel):
    """Container describing supported models for a provider."""

    default_model: str = Field(..., description="Key of the default model for this provider.")
    models: dict[str, ModelDescriptor] = Field(default_factory=dict, description="Mapping of supported model keys.")

    def get_model(self, key: str | None) -> tuple[str, ModelDescriptor]:
        """Return the configured model descriptor or fall back to the provider default."""
        model_key = key or self.default_model
        if model_key not in self.models:
            raise KeyError(f"Unknown model '{model_key}'. Supported models: {', '.join(sorted(self.models)) or 'none'}.")
        return model_key, self.models[model_key]


class AssistantSettings(BaseSettings):
    """Environment-driven configuration for the assistant integration."""

    provider: Provider = Field(default="openai", alias="OPENAI_PROVIDER")
    api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    api_base: str | None = Field(default=None, alias="OPENAI_API_BASE")
    api_version: str | None = Field(default=None, alias="OPENAI_API_VERSION")
    organization: str | None = Field(default=None, alias="OPENAI_ORG_ID")
    use_managed_identity: bool = Field(default=False, alias="OPENAI_USE_MANAGED_IDENTITY")
    model_config_path: Path = Field(default=DEFAULT_MODEL_CONFIG_PATH, alias="ASSISTANT_MODEL_CONFIG_PATH")
    history_ttl_seconds: int = Field(default=900, alias="ASSISTANT_HISTORY_TTL_SECONDS")
    history_max_items: int = Field(default=128, alias="ASSISTANT_HISTORY_MAX_ITEMS")

    _model_config_dict: dict[str, ProviderModelConfig] = PrivateAttr(default_factory=dict)

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def model_post_init(self, __context: object) -> None:
        # Normalise string env values into paths relative to project root.
        if isinstance(self.model_config_path, str):
            self.model_config_path = Path(self.model_config_path)
        if not self.model_config_path.is_absolute():
            # Resolve relative paths against the repository root (assumed to be two levels up).
            repo_root = Path(__file__).resolve().parents[3]
            self.model_config_path = (repo_root / self.model_config_path).resolve()
        self._model_config_dict = self._load_model_config()

    def _load_model_config(self) -> dict[str, ProviderModelConfig]:
        """Load the JSON model configuration file and coerce it into ProviderModelConfig objects."""
        if not self.model_config_path.exists():
            raise FileNotFoundError(f"Model configuration file '{self.model_config_path}' is missing.")
        try:
            raw_config = json.loads(self.model_config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON in model configuration: {exc}") from exc
        parsed: dict[str, ProviderModelConfig] = {}
        for provider_key, payload in raw_config.items():
            try:
                provider_cfg = ProviderModelConfig(**payload)
                for model_key, descriptor in provider_cfg.models.items():
                    provider_cfg.models[model_key] = self._apply_token_defaults(descriptor)
                parsed[provider_key] = provider_cfg
            except ValidationError as exc:
                raise ValueError(f"Invalid model definition for provider '{provider_key}': {exc}") from exc
        return parsed

    @staticmethod
    def _apply_token_defaults(descriptor: ModelDescriptor) -> ModelDescriptor:
        key = (descriptor.model or descriptor.deployment or "").lower()
        limit_key = next((name for name in DEFAULT_MODEL_LIMITS if name in key), None)
        if not limit_key:
            return descriptor
        limits = DEFAULT_MODEL_LIMITS[limit_key]
        updated = descriptor.model_copy(
            update={
                "total_context_window": descriptor.total_context_window or limits["total_context_window"],
                "max_output_tokens": descriptor.max_output_tokens or limits["max_output_tokens"],
                "max_input_tokens": descriptor.max_input_tokens or limits["max_input_tokens"],
            }
        )
        return updated

    def provider_config(self) -> ProviderModelConfig:
        """Return the ProviderModelConfig matching the selected provider."""
        provider_key = self.provider
        if provider_key not in self._model_config_dict:
            raise ValueError(f"Provider '{provider_key}' is not defined in model_config.json.")
        return self._model_config_dict[provider_key]


def get_assistant_settings() -> AssistantSettings:
    """Instantiate and cache AssistantSettings."""
    # Lazy import ensures pydantic_settings only loads when the assistant entrypoint is invoked.
    if not hasattr(get_assistant_settings, "_instance"):
        get_assistant_settings._instance = AssistantSettings()  # type: ignore[attr-defined]
    return get_assistant_settings._instance  # type: ignore[attr-defined]
