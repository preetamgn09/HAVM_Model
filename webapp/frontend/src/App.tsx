import { Component, ReactNode, Suspense, lazy } from "react";
import { Route, Routes, Link } from "react-router-dom";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";

const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const Monitors = lazy(() => import("./pages/Monitors"));
const Performance = lazy(() => import("./pages/Performance"));
const Evidence = lazy(() => import("./pages/Evidence"));
const Governance = lazy(() => import("./pages/Governance"));
const Registry = lazy(() => import("./pages/Registry"));
const Audit = lazy(() => import("./pages/Audit"));
const Replay = lazy(() => import("./pages/Replay"));

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div className="panel panel-pad text-sm" role="alert">
        <div className="font-medium">This page hit an unexpected error.</div>
        <div className="mt-1 text-muted">{this.state.error.message}</div>
        <button className="btn btn-quiet mt-3" onClick={() => location.reload()}>Reload page</button>
      </div>);
    return this.props.children;
  }
}

function NotFound() {
  return <div className="panel panel-pad text-sm"><div className="font-medium">No page at this address.</div>
    <Link to="/" className="mt-2 inline-block text-cyan">Go to the Command Center</Link></div>;
}

export default function App() {
  return (
    <Layout>
      <Boundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/monitors" element={<Monitors />} />
            <Route path="/monitors/:id" element={<Monitors />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/governance" element={<Governance />} />
            <Route path="/registry" element={<Registry />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/replay" element={<Replay />} />
            <Route path="/replay/:runId" element={<Replay />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Boundary>
    </Layout>
  );
}
