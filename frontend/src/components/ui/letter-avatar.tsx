interface LetterAvatarProps {
  name: string;
  size?: number;
  className?: string;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const BG_COLORS = [
  "#ea580c",
  "#2563eb",
  "#65a30d",
  "#0f766e",
  "#c2410c",
  "#7c3aed",
  "#be123c",
  "#0369a1",
];

export function LetterAvatar({ name, size = 24, className = "" }: LetterAvatarProps) {
  const safeName = (name || "?").trim();
  const initial = safeName.charAt(0).toUpperCase();
  const color = BG_COLORS[hashString(safeName) % BG_COLORS.length];

  return (
    <div
      className={`inline-grid place-items-center font-semibold text-white select-none ${className}`.trim()}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: Math.max(10, Math.round(size * 0.42)),
      }}
      aria-hidden="true"
    >
      <span
        style={{
          lineHeight: 1,
        }}
      >
        {initial}
      </span>
    </div>
  );
}
