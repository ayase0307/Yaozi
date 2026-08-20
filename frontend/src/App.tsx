import { useEffect, useState } from "react";
import Editor from "./Editor";
import Home from "./Home";
import { applyUiFont, loadUiFont } from "./UiFont";

// 進站就套上次選的介面字型,兩個頁面都算數
applyUiFont(loadUiFont());

function parseHash(): { page: "home" } | { page: "editor"; id: string } {
  const m = location.hash.match(/^#\/p\/([a-z0-9]+)/);
  return m ? { page: "editor", id: m[1] } : { page: "home" };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route.page === "editor" ? <Editor key={route.id} projectId={route.id} /> : <Home />;
}
