import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("share-target", "routes/share-target.tsx"),
  route("api/chat-stream", "routes/api.chat-stream.ts"),
  route("api/receipt", "routes/api.receipt.ts"),
  route("ping", "routes/ping.ts"),
] satisfies RouteConfig;
