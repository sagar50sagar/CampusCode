CampusCode local setup (with Piston Docker execution)

1. Start Piston code runner:
   - `npm run piston:up`

2. Verify Piston is online:
   - Open `http://127.0.0.1:2000/api/v2/runtimes`

3. Start CampusCode app:
   - `node app.js`

Environment:
- `PISTON_API_URL=http://127.0.0.1:2000`

Useful commands:
- `npm run piston:logs`
- `npm run piston:down`
