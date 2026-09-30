import { DEFAULT_API_URL, absoluteApiBase } from "../api.js";

// Shown when the API the site points at answers 404 for an endpoint only the FastAPI backend has (the payload
// list and the sanitizer). The built-in Python server does not implement them.
export function ApiHint({ what }) {
  return (
    <div className="api-hint" role="note">
      <p><strong>{`This API does not provide ${what}.`}</strong>{" "}The site is talking to <code>{absoluteApiBase()}</code>.</p>
      <p>
        That endpoint belongs to the FastAPI backend. Start it (<code>uvicorn app.main:app --port 8000</code> in{" "}
        <code>backend/</code>) and run the site with <code>npm run dev</code>, which uses <code>{DEFAULT_API_URL}</code>.
        To use another server, set <code>VITE_API_URL</code> (see <code>frontend/.env.example</code>).
      </p>
    </div>
  );
}
