import { createApp } from "./app";
import { config } from "./config";

const port = config.port;

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
