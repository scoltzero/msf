#!/usr/bin/env python3
"""Deterministic UDP/TCP DNS fixture for the IPv4/IPv6 preference matrix."""

from __future__ import annotations

import argparse
import ipaddress
import signal
import socket
import socketserver
import struct
import threading


TYPE_A = 1
TYPE_CNAME = 5
TYPE_AAAA = 28
CLASS_IN = 1
TTL = 60

RECORDS = {
    "dual.test.": {TYPE_A: ["192.0.2.10"], TYPE_AAAA: ["2001:db8::10"]},
    "v4-only.test.": {TYPE_A: ["192.0.2.20"]},
    "v6-only.test.": {TYPE_AAAA: ["2001:db8::20"]},
    "cname-dual.test.": {TYPE_CNAME: ["dual.test."]},
    "no-address.test.": {},
}


def decode_name(message: bytes, offset: int) -> tuple[str, int]:
    labels: list[str] = []
    while True:
        length = message[offset]
        offset += 1
        if length == 0:
            break
        if length & 0xC0:
            raise ValueError("compressed question names are not supported")
        labels.append(message[offset : offset + length].decode("ascii"))
        offset += length
    return ".".join(labels).lower() + ".", offset


def encode_name(name: str) -> bytes:
    return b"".join(bytes([len(label)]) + label.encode("ascii") for label in name.rstrip(".").split(".")) + b"\x00"


def resource_record(owner: bytes, rtype: int, value: str) -> bytes:
    if rtype == TYPE_A:
        rdata = ipaddress.IPv4Address(value).packed
    elif rtype == TYPE_AAAA:
        rdata = ipaddress.IPv6Address(value).packed
    elif rtype == TYPE_CNAME:
        rdata = encode_name(value)
    else:
        raise ValueError(f"unsupported record type: {rtype}")
    return owner + struct.pack("!HHIH", rtype, CLASS_IN, TTL, len(rdata)) + rdata


def answer_query(message: bytes) -> bytes:
    if len(message) < 12:
        return b""
    query_id, flags, qdcount, _, _, _ = struct.unpack("!HHHHHH", message[:12])
    if qdcount != 1:
        return struct.pack("!HHHHHH", query_id, 0x8001, 0, 0, 0, 0)

    qname, offset = decode_name(message, 12)
    if offset + 4 > len(message):
        return b""
    qtype, qclass = struct.unpack("!HH", message[offset : offset + 4])
    question = message[12 : offset + 4]
    answers: list[bytes] = []
    rcode = 0

    if qclass != CLASS_IN:
        rcode = 4
    elif qname not in RECORDS:
        rcode = 3
    else:
        records = RECORDS[qname]
        owner = b"\xc0\x0c"
        if TYPE_CNAME in records and qtype in (TYPE_A, TYPE_AAAA, TYPE_CNAME):
            target = records[TYPE_CNAME][0]
            answers.append(resource_record(owner, TYPE_CNAME, target))
            if qtype in (TYPE_A, TYPE_AAAA):
                for value in RECORDS[target].get(qtype, []):
                    answers.append(resource_record(encode_name(target), qtype, value))
        else:
            for value in records.get(qtype, []):
                answers.append(resource_record(owner, qtype, value))

    response_flags = 0x8000 | 0x0400 | (flags & 0x0100) | rcode
    header = struct.pack("!HHHHHH", query_id, response_flags, 1, len(answers), 0, 0)
    return header + question + b"".join(answers)


class UDPHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        data, sock = self.request
        response = answer_query(data)
        if response:
            sock.sendto(response, self.client_address)


class TCPHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        length_data = self.request.recv(2)
        if len(length_data) != 2:
            return
        expected = struct.unpack("!H", length_data)[0]
        chunks = bytearray()
        while len(chunks) < expected:
            chunk = self.request.recv(expected - len(chunks))
            if not chunk:
                return
            chunks.extend(chunk)
        response = answer_query(bytes(chunks))
        self.request.sendall(struct.pack("!H", len(response)) + response)


class ThreadingUDPServer(socketserver.ThreadingUDPServer):
    allow_reuse_address = True


class ThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def serve(host: str, port: int) -> None:
    udp = ThreadingUDPServer((host, port), UDPHandler)
    tcp = ThreadingTCPServer((host, port), TCPHandler)
    threads = [
        threading.Thread(target=udp.serve_forever, daemon=True),
        threading.Thread(target=tcp.serve_forever, daemon=True),
    ]
    for thread in threads:
        thread.start()

    stopped = threading.Event()

    def shutdown(_signum: int, _frame: object) -> None:
        stopped.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    print(f"DNS fixture listening on {host}:{port} (UDP/TCP)", flush=True)
    stopped.wait()
    udp.shutdown()
    tcp.shutdown()
    udp.server_close()
    tcp.server_close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=15353)
    args = parser.parse_args()
    serve(args.host, args.port)


if __name__ == "__main__":
    main()
