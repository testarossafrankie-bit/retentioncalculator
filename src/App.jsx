import Retention from './pages/Retention.jsx';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1">
        <Retention />
      </div>
      <footer className="border-t border-slate-200 bg-white text-center text-xs text-slate-500 py-4 leading-relaxed">
        <div>Developed by FPT</div>
        <div>© 2026 F Terragrossa LLC. All Rights Reserved.</div>
      </footer>
    </div>
  );
}
