from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from ...assistant import AssistantService, AssistantConfig, ChatRequest, ChatResponse
from ..deps import get_user
from ...core.security import UserContext

router = APIRouter(prefix="/assistant", tags=["assistant"])
service = AssistantService()
logger = logging.getLogger(__name__)
RUNTIME_ERROR_MESSAGE = "Assistant is temporarily unavailable. Please try again later."
INVALID_REQUEST_MESSAGE = "Invalid request. Please check your inputs and try again."


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, user: UserContext = Depends(get_user)) -> ChatResponse:
    """Entry point for the SWFT assistant."""
    try:
        return service.generate(request)
    except ValueError as exc:
        logger.info("Invalid assistant request: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=INVALID_REQUEST_MESSAGE,
        ) from exc
    except RuntimeError as exc:
        logger.exception("Assistant runtime failure during chat request")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=RUNTIME_ERROR_MESSAGE,
        ) from exc


@router.get("/config", response_model=AssistantConfig)
async def config(user: UserContext = Depends(get_user)) -> AssistantConfig:
    """Expose assistant runtime configuration to the frontend."""
    return service.configuration()


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest, user: UserContext = Depends(get_user)) -> StreamingResponse:
    """Stream assistant responses as newline-delimited JSON events."""
    try:
        generator = service.stream(request)
    except ValueError as exc:
        logger.info("Invalid assistant streaming request: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=INVALID_REQUEST_MESSAGE,
        ) from exc
    except RuntimeError as exc:
        logger.exception("Assistant runtime failure during streaming chat request")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=RUNTIME_ERROR_MESSAGE,
        ) from exc
    return StreamingResponse(generator, media_type="application/x-ndjson")
