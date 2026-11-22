import './styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (root) {
  if (import.meta.env.DEV && (await import('./dev/scope-test')).isScopeTest(location)) {
    void (await import('./dev/scope-test')).runScopeTest(root);
  } else {
    void new App(root).start();
  }
}
