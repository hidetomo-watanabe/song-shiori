import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isKey } from '../../shared/keys';
import { Top } from './ui/Top';
import { Editor } from './ui/Editor';
import { View } from './ui/View';
import { Privacy } from './ui/Privacy';
import { Mine } from './ui/Mine';
import * as L from './storage/local';
import { syncKeys } from './storage/mykey';

// ハッシュで画面を切り替える（GitHub Pages で動かすため。閲覧識別子はサーバーのログにも残らない）
function route(hash: string) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(query) };
}

// リンクで渡されたキー（編集リンク・管理リンクの ?k=、マイキーのリンク）は、このブラウザに保存してアドレスバーから消す
function takeKey(hash: string) {
  const { parts, query } = route(hash);
  const k = query.get('k');
  if (!isKey(k)) return hash;
  if (parts[0] === 'e' && parts[1]) L.setKey(parts[1], k);
  else if (parts[0] === 'mine') L.setMyKey(k);
  else return hash;
  query.delete('k');
  const clean = `#/${parts.join('/')}${query.size ? `?${query}` : ''}`;
  history.replaceState(null, '', clean);
  return clean;
}

function App() {
  // n：同じ画面に別のキーのリンクを貼ったとき（アドレスバーから消すとハッシュが変わらない）にも開き直す
  const [nav, setNav] = useState(() => ({ hash: takeKey(location.hash), n: 0 }));
  useEffect(() => {
    const on = () => { setNav((p) => ({ hash: takeKey(location.hash), n: p.n + 1 })); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const { hash } = nav;
  const key = `${hash}:${nav.n}`;
  const { parts, query } = route(hash);
  if (parts[0] === 'new') return <Editor key={key} mode={{ kind: 'draft', manual: query.has('manual') || query.has('import'), importText: query.has('import') }} />;
  if (parts[0] === 'e' && parts[1]) return <Editor key={key} mode={{ kind: 'saved', id: parts[1] }} />;
  if (parts[0] === 'v' && parts[1]) return <View key={key} viewId={parts[1]} />;
  if (parts[0] === 'privacy') return <Privacy />;
  if (parts[0] === 'mine') return <Mine key={key} />;
  return <Top />;
}

// 開いたときにも同期しておく（別の端末で作ったものを取り込む）。トップと #/mine は一覧を出す前に自分で同期する
const first = route(location.hash).parts[0];
if (L.getMyKey() && first && first !== 'mine') syncKeys().catch(() => {});

render(<App />, document.getElementById('app')!);
