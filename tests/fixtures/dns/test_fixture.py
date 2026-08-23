#!/usr/bin/env python3
"""Self-test for the deterministic DNS fixture over UDP and TCP."""

from __future__ import annotations

import ipaddress
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PORT = 15354
TYPE_A = 1
TYPE_CNAME = 5
TYPE_AAAA = 28


def encode_name(name: str) -> bytes:
    return b"".join(bytes([len(part)]) + part.encode() for part in name.split(".")) + b"\x00"


def query(name: str, qtype: int, tcp: bool) -> bytes:
    message = struct.pack("!HHHHHH", 0x4D53, 0x0100, 1, 0, 0, 0) + encode_name(name) + struct.pack("!HH", qtype, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM) as sock:
        sock.settimeout(2)
        if tcp:
            sock.connect(("127.0.0.1", PORT))
            sock.sendall(struct.pack("!H", len(message)) + message)
            size = struct.unpack("!H", sock.recv(2))[0]
            response = bytearray()
            while len(response) < size:
                response.extend(sock.recv(size - len(response)))
            return bytes(response)
        sock.sendto(message, ("127.0.0.1", PORT))
        return sock.recv(4096)


def skip_name(message: bytes, offset: int) -> int:
    while True:
        length = message[offset]
        if length & 0xC0:
            return offset + 2
        offset += 1
        if length == 0:
            return offset
        offset += length


def answer_values(message: bytes) -> tuple[int, list[tuple[int, str]]]:
    _, flags, questions, answers, _, _ = struct.unpack("!HHHHHH", message[:12])
    offset = 12
    for _ in range(questions):
        offset = skip_name(message, offset) + 4
    values: list[tuple[int, str]] = []
    for _ in range(answers):
        offset = skip_name(message, offset)
        rtype, _, _, length = struct.unpack("!HHIH", message[offset : offset + 10])
        offset += 10
        data = message[offset : offset + length]
        offset += length
        if rtype == TYPE_A:
            values.append((rtype, str(ipaddress.IPv4Address(data))))
        elif rtype == TYPE_AAAA:
            values.append((rtype, str(ipaddress.IPv6Address(data))))
        elif rtype == TYPE_CNAME:
            values.append((rtype, "cname"))
    return flags & 0xF, values


def assert_query(name: str, qtype: int, expected: list[tuple[int, str]], rcode: int = 0) -> None:
    for tcp in (False, True):
        actual_rcode, actual = answer_values(query(name, qtype, tcp))
        assert actual_rcode == rcode, (name, qtype, tcp, actual_rcode)
        assert actual == expected, (name, qtype, tcp, actual)


def main() -> None:
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "dns_fixture.py"), "--port", str(PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                assert_query("dual.test", TYPE_A, [(TYPE_A, "192.0.2.10")])
                break
            except (OSError, AssertionError):
                time.sleep(0.05)
        else:
            raise RuntimeError("DNS fixture did not become ready")

        assert_query("dual.test", TYPE_AAAA, [(TYPE_AAAA, "2001:db8::10")])
        assert_query("v4-only.test", TYPE_AAAA, [])
        assert_query("v6-only.test", TYPE_AAAA, [(TYPE_AAAA, "2001:db8::20")])
        assert_query("cname-dual.test", TYPE_AAAA, [(TYPE_CNAME, "cname"), (TYPE_AAAA, "2001:db8::10")])
        assert_query("no-address.test", TYPE_AAAA, [])
        assert_query("missing.test", TYPE_AAAA, [], rcode=3)
        print("DNS fixture UDP/TCP matrix passed")
    finally:
        process.terminate()
        process.wait(timeout=5)


if __name__ == "__main__":
    main()
