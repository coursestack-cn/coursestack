import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const target = document.getElementById('app');

if (!target) {
  throw new Error('未找到应用挂载节点。');
}

const app = mount(App, { target });

export default app;