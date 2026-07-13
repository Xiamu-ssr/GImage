import { Sparkles } from 'lucide-react';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="GImage">
      <span className="brand-mark"><Sparkles size={compact ? 15 : 18} strokeWidth={2.4} /></span>
      {!compact && <span>GImage</span>}
    </div>
  );
}
