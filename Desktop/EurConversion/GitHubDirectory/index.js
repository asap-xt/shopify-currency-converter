import { serve } from "@remix-run/node";
import { createRequestHandler } from "@remix-run/express";
import express from "express";

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? null
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        })
      );

const app = express();
app.use(
  viteDevServer ? viteDevServer.ssrFixStacktrace : (req, res, next) => next()
);

if (viteDevServer) {
  app.use(viteDevServer.middlewares);
} else {
  app.use("/build", express.static("public/build"));
}

app.all("*", createRequestHandler({ build: () => import("./build") }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Express server listening on port ${port}`);
});