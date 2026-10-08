import './ui/style.css';
import { App } from './ui/app';

const app = new App();
(window as unknown as { tdApp: App }).tdApp = app;
