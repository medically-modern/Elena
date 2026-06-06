import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db/init.js";
import chatRoutes from "./routes/chat.js";
import conversationRoutes from "./routes/conversations.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3200;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// API routes
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "elena" }));
app.use("/api/chat", chatRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/admin", adminRoutes);

// Serve static frontend
app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(path.join(__dirname, "../public/index.html"));
  }
});

initDb();
app.listen(PORT, () => console.log(\`Elena running on port \${PORT}\`));

