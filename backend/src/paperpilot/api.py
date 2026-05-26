from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from paperpilot.auth import current_user
from paperpilot.config import settings
from paperpilot.models import MeResponse

app = FastAPI(title="PaperPilot API")

origins = [o.strip() for o in settings.frontend_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/me", response_model=MeResponse)
async def me(request: Request, user_id: str = Depends(current_user)):
    return {"user_id": user_id, "email": getattr(request.state, "user_email", "")}
