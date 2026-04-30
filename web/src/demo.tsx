import { createRoot } from "react-dom/client";
import "./App.css";
import { Demo } from "./components/Demo";

const root = document.getElementById("root")!;
createRoot(root).render(<Demo />);
