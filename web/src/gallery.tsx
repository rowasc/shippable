import { createRoot } from "react-dom/client";
import "./App.css";
import { Gallery } from "./components/Gallery";
import { applyTokensToRoot } from "./tokens";

applyTokensToRoot(document.documentElement);
document.documentElement.dataset.colorMode = "dark";

const root = document.getElementById("root")!;
createRoot(root).render(<Gallery />);
