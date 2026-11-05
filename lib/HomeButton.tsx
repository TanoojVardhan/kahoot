'use client';

// Top-left "Home" link. Pass confirmText when leaving would cost the user something (a live game).
export default function HomeButton({ confirmText }: { confirmText?: string }) {
  return (
    <a
      href="/"
      className="homebtn"
      onClick={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}
    >
      ← Home
    </a>
  );
}
