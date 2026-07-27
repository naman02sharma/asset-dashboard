export const ASSET_STATUS_STYLES = {
  available:     { label: 'Available',    dot: 'bg-green-500',  text: 'text-green-700',  bg: 'bg-green-50' },
  in_use:        { label: 'In Use',       dot: 'bg-blue-500',   text: 'text-blue-700',   bg: 'bg-blue-50' },
  under_repair:  { label: 'Under Repair', dot: 'bg-amber-500',  text: 'text-amber-700',  bg: 'bg-amber-50' },
  retired:       { label: 'Retired',      dot: 'bg-slate-400',  text: 'text-slate-600',  bg: 'bg-slate-100' },
};

export default function AssetStatusBadge({ status }) {
  const style = ASSET_STATUS_STYLES[status] || ASSET_STATUS_STYLES.available;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
