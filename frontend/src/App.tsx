import { useEffect, useState } from "react";
import Editor from "./Editor";
import { useFontGroups } from "./FontPicker";
import Home from "./Home";
import Settings from "./Settings";
import { applyUiFont, loadUiFont } from "./UiFont";
import { applyUiSize, loadUiSize } from "./UiSize";

// 進站就套上次選的介面字型與字級,每個頁面都算數
applyUiFont(loadUiFont());
applyUiSize(loadUiSize());

function parseHash(): { page: "home" | "settings" } | { page: "editor"; id: string } {
  const m = location.hash.match(/^#\/p\/([a-z0-9]+)/);
  if (m) return { page: "editor", id: m[1] };
  return { page: location.hash.startsWith("#/settings") ? "settings" : "home" };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  // 在最外層拿字型清單:清單一回來整棵樹重畫,底下所有 fontStack() 才補得到英文名
  const fontGroups = useFontGroups();

  useEffect(() => {
    if (fontGroups.length) applyUiFont(loadUiFont());
  }, [fontGroups]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.page === "editor") return <Editor key={route.id} projectId={route.id} />;
  return route.page === "settings" ? <Settings /> : <Home />;
}
