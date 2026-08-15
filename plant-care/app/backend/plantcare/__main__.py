import uvicorn

if __name__ == "__main__":
    uvicorn.run("plantcare.main:create_app", factory=True, host="127.0.0.1", port=8080)
