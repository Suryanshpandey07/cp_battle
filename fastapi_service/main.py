from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from .routers import problems, judge

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("cp_battle_fastapi")

app = FastAPI(
    title="CP Battle Python Service",
    description="Microservice for Codeforces problem catalog, statement parsing, and code judging.",
    version="1.0.0"
)

# Enable CORS for frontend and Node.js backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(problems.router)
app.include_router(judge.router)

@app.get("/")
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "CP Battle FastAPI Engine",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
