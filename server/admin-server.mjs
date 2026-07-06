import "./env.mjs";
import { startServer } from "./server.mjs";

process.env.EDGELAB_ENABLE_ADMIN_API = "true";

startServer();
