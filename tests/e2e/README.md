# IPv6 UI end-to-end test

The Playwright script starts the Vite development server, mocks only the HTTP API boundary, and verifies the browser-visible IPv6 settings flow:

- disabled/enabled summary text;
- the FakeIP cache troubleshooting hint;
- one setup save request and canonical FakeIPv6 prefix after refresh;
- automatic, IPv4-first, and IPv6-first UI state;
- one atomic priority request, pending-state protection, refresh persistence, and optimistic rollback on failure.

Run it from the repository root:

```bash
npm ci
npm --prefix web ci
npx playwright install chromium
npm run test:e2e:ipv6
```

Set `HEADED=1` to see the browser. Set `MSF_E2E_BASE_URL` to test an already running frontend instead of starting Vite locally.
