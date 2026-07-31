interface SeriesChipProps {
  /** The swatch colour. Omitted for a figure that is not drawn in the chart. */
  color?: string
  label: string
  /** Already formatted: the chip does not know whether it holds events or milliseconds. Left
   *  out where the chip names a thing rather than measuring it (the level filters). */
  value?: string
  pressed?: boolean
  /** Drawn faint while another chip in the group is the isolated one. */
  dimmed?: boolean
  /** Omitted makes the chip a readout instead of a control. */
  onClick?: () => void
  title?: string
}

/**
 * One series of a chart, as its colour key and its total in one chip.
 *
 * The legend is the readout, which is why a chart with these above it needs no separate row of
 * figures repeating them. Chips that isolate their series in the chart are buttons; chips that
 * only report a number are not, and the two look the same on purpose — every lane of a chart
 * gets the same header whether or not its series can be singled out.
 */
export function SeriesChip({ color, label, value, pressed, dimmed, onClick, title }: SeriesChipProps) {
  const shape = 'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs'
  const content = (
    <>
      {/* the swatch is lit by its own colour, so a 8px dot still reads as violet rather than as
          "some dark dot" once it is sitting on a translucent surface over a dark canvas */}
      {color && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px 0 ${color}` }}
          aria-hidden="true"
        />
      )}
      <span className={pressed ? 'text-fg' : 'text-fg-muted'}>{label}</span>
      {value !== undefined && <span className="tabular font-medium text-fg">{value}</span>}
    </>
  )

  if (!onClick) {
    return <span className={`${shape} border-border bg-surface-inset`}>{content}</span>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      className={`${shape} transition-all duration-200 ${
        pressed
          ? 'border-accent/50 bg-accent/12 text-fg shadow-[0_0_12px_-4px_var(--color-accent)]'
          : `border-border bg-surface-inset hover:border-border-strong hover:bg-surface-hover ${dimmed ? 'opacity-40' : ''}`
      }`}
    >
      {content}
    </button>
  )
}
