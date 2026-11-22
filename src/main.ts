import './styles.css';
import { applyTheme } from './theme';
import { App } from './ui/app';

// public/theme.js has applied the stored theme already; this covers a page
// where it did not run.
applyTheme();

const root = document.getElementById('app');
if (root) {
  if (import.meta.env.DEV && (await import('./dev/scope-test')).isScopeTest(location)) {
    void (await import('./dev/scope-test')).runScopeTest(root);
  } else {
    void new App(root).start();
  }
}
