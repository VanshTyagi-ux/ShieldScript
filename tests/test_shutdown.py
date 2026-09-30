import json
import signal
import threading
import unittest
import urllib.request

from xss_detector.config import Config
from xss_detector.server import Handler, HardenedServer, install_shutdown_handlers, run_server


class ShutdownTests(unittest.TestCase):
    def setUp(self):
        saved = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
        self.addCleanup(lambda: [signal.signal(sig, handler) for sig, handler in saved.items()])

    def test_sigterm_stops_serve_forever(self):
        httpd = HardenedServer(("127.0.0.1", 0), Handler, Config())
        stopped = threading.Event()

        def run():
            run_server(httpd)
            stopped.set()

        threading.Thread(target=run, daemon=True).start()
        install_shutdown_handlers(httpd)
        signal.raise_signal(signal.SIGTERM)
        self.assertTrue(stopped.wait(5), "the server did not stop after SIGTERM")

    def test_a_second_signal_while_stopping_does_not_raise(self):
        httpd = HardenedServer(("127.0.0.1", 0), Handler, Config())
        stopped = threading.Event()

        def run():
            run_server(httpd)
            stopped.set()

        threading.Thread(target=run, daemon=True).start()
        install_shutdown_handlers(httpd)
        signal.raise_signal(signal.SIGTERM)
        signal.raise_signal(signal.SIGTERM)
        self.assertTrue(stopped.wait(5))

    def test_an_in_flight_request_finishes_before_the_server_exits(self):
        started, gate = threading.Event(), threading.Event()

        class Slow(Handler):
            def do_POST(self):
                started.set()
                gate.wait(10)
                super().do_POST()

        httpd = HardenedServer(("127.0.0.1", 0), Slow, Config())
        stopped = threading.Event()

        def run():
            run_server(httpd)
            stopped.set()

        threading.Thread(target=run, daemon=True).start()
        install_shutdown_handlers(httpd)

        reply = {}

        def client():
            request = urllib.request.Request(
                f"http://127.0.0.1:{httpd.server_address[1]}/api/scan", data=json.dumps({"text": "hi"}).encode(),
                headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=10) as resp:
                reply["status"] = resp.status
                reply["body"] = json.loads(resp.read())

        client_thread = threading.Thread(target=client)
        client_thread.start()
        self.assertTrue(started.wait(5), "the request never reached the handler")

        signal.raise_signal(signal.SIGTERM)
        self.assertFalse(stopped.wait(0.7), "the server exited while a request was still in flight")

        gate.set()
        client_thread.join(5)
        self.assertEqual(reply.get("status"), 200)
        self.assertIn("score", reply["body"])
        self.assertTrue(stopped.wait(5), "the server did not exit after the request finished")


if __name__ == "__main__":
    unittest.main()
