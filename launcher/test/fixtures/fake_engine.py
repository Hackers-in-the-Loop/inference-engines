"""A tiny OpenAI-compatible server for launcher tests.

It answers /v1/models, /v1/chat/completions (non-streaming and streaming) and
/metrics. A user message "call NAME ARGS_JSON" becomes a tool call; anything
else is echoed back as text.
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = {"requests": 0, "decode_tokens": 0, "decode_ms": 0.0}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/v1/models":
            return self._send(200, {"object": "list", "data": [{"id": "fake", "object": "model"}]})
        if self.path == "/metrics":
            text = (
                f"fake_requests_total {STATE['requests']}\n"
                f"fake_decode_tokens_total {STATE['decode_tokens']}\n"
                f"fake_decode_ms_total {STATE['decode_ms']}\n"
            )
            return self._send(200, text.encode(), "text/plain")
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            return self._send(404, {"error": "not found"})
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if body.get("stream") and os.environ.get("FAKE_NO_STREAM"):
            return self._send(400, {"error": {"message": "streaming is not supported", "code": "unsupported"}})
        text = body["messages"][-1]["content"]
        STATE["requests"] += 1
        STATE["decode_tokens"] += 5
        STATE["decode_ms"] += 50.0
        calls = []
        if text.startswith("call "):
            _, name, args = text.split(" ", 2)
            calls = [{"id": "c0", "type": "function", "function": {"name": name, "arguments": args}}]
        usage = {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8}
        if body.get("stream"):
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            for piece in ["a", "b", "c", "d", "e"]:
                time.sleep(0.005)
                chunk = {"choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            end = {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": usage}
            self.wfile.write(f"data: {json.dumps(end)}\n\ndata: [DONE]\n\n".encode())
            return
        message = {"role": "assistant", "content": None if calls else text}
        if calls:
            message["tool_calls"] = calls
        return self._send(200, {
            "object": "chat.completion",
            "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if calls else "stop"}],
            "usage": usage,
        })


if __name__ == "__main__":
    port = int(os.environ.get("IE_HTTP_PORT", sys.argv[1] if len(sys.argv) > 1 else "8000"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
