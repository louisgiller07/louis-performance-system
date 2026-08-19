interface RatingSliderProps {
  label: string;
  value: number | "";
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  error?: string;
}

export function RatingSlider({ label, value, min = 0, max = 10, onChange, error }: RatingSliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-sm text-gray-700">
        <span>{label}</span>
        <span className="font-mono text-xs text-gray-400">{value === "" ? "—" : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value === "" ? min : value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-full touch-manipulation accent-gray-900"
      />
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}
