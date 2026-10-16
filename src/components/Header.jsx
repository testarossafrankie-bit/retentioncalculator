export default function Header() {
  return (
    <header className="section-header text-white">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-xs tracking-widest text-teal-300">FBI · INSURANCE</div>
          <h1 className="text-xl font-bold">Producer Quality Dashboard</h1>
        </div>
        <div className="text-right text-xs text-slate-300">
          <div>Sales Log ↔ EZLynx Book of Business</div>
          <div>Policy Master + corrections persist in KV</div>
        </div>
      </div>
    </header>
  );
}
