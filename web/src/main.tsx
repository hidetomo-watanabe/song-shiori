import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Top } from './ui/Top';
import { Editor } from './ui/Editor';
import { View } from './ui/View';
import { Privacy } from './ui/Privacy';

// ハッシュで画面を切り替える（GitHub Pages で動かすため。閲覧識別子はサーバーのログにも残らない）
function route(hash: string) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(query) };
}

function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const { parts, query } = route(hash);
  if (parts[0] === 'new') return <Editor key={hash} mode={{ kind: 'draft', manual: query.has('manual') || query.has('import'), importText: query.has('import') }} />;
  if (parts[0] === 'e' && parts[1]) return <Editor key={hash} mode={{ kind: 'saved', id: parts[1] }} />;
  if (parts[0] === 'v' && parts[1]) return <View key={hash} viewId={parts[1]} />;
  if (parts[0] === 'privacy') return <Privacy />;
  return <Top />;
}

render(<App />, document.getElementById('app')!);
