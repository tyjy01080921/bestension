interface WaveformProps {
  data: number[]       // 0-255 values
  color?: string
  height?: number
}

export default function Waveform({ data, color = '#ffffff', height = 48 }: WaveformProps) {
  const bars = data.length
  const maxVal = 255

  return (
    <div
      className="flex items-center justify-center gap-[2px] w-full overflow-hidden rounded-lg"
      style={{ height }}
    >
      {data.map((v, i) => {
        const barH = Math.max(3, Math.round((v / maxVal) * height * 0.9))
        return (
          <div
            key={i}
            className="rounded-full flex-shrink-0"
            style={{
              width: `${Math.floor(100 / bars)}%`,
              maxWidth: 4,
              minWidth: 2,
              height: barH,
              background: color,
              opacity: 0.85,
            }}
          />
        )
      })}
    </div>
  )
}
