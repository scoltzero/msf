# Deterministic DNS fixture

This fixture provides stable records for the MosDNS IPv4/IPv6 preference matrix and listens on both UDP and TCP.

```bash
python3 tests/fixtures/dns/dns_fixture.py --host 127.0.0.1 --port 15353
npm run test:dns-fixture
```

| Name | A | AAAA |
|---|---|---|
| `dual.test` | `192.0.2.10` | `2001:db8::10` |
| `v4-only.test` | `192.0.2.20` | NODATA |
| `v6-only.test` | NODATA | `2001:db8::20` |
| `cname-dual.test` | CNAME to `dual.test` | CNAME to `dual.test` |
| `no-address.test` | NODATA | NODATA |

Unknown names return NXDOMAIN. The fixture uses documentation-only address ranges and does not contact public DNS.
