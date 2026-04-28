import { createRoot } from "react-dom/client";
import "./App.css";
import { Gallery } from "./components/Gallery";
import { applyThemeToRoot, getStoredThemeId } from "./tokens";

applyThemeToRoot(document.documentElement, getStoredThemeId());

const root = document.getElementById("root")!;
createRoot(root).render(<Gallery />);
