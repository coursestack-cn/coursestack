import { mount } from "svelte";
import Preview from "./Preview.svelte";
import "../styles/tokens.css";
import "../styles/base.css";

const target = document.getElementById("app");

if (!target) {
    throw new Error("未找到预览页挂载节点。");
}

mount(Preview, { target });