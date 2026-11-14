// Plain GET form, so it works on the server-rendered home page without client JavaScript.
export const EXAMPLES = ['3 bed apartments under $2,000', 'Studio in Montrose under $1,500', 'Homes under $400k', '2 bed in the Heights'];

const Glass = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export default function SearchBar({ defaultValue = '', size = 'lg', action = '/search' }: { defaultValue?: string; size?: 'lg' | 'sm'; action?: string }) {
  const lg = size === 'lg';
  return (
    <form
      action={action}
      method="get"
      role="search"
      className={`flex items-center rounded-full border border-line bg-card shadow-[0_3px_12px_rgba(0,0,0,0.45)] transition focus-within:border-ink/30 hover:shadow-[0_6px_20px_rgba(0,0,0,0.6)] ${lg ? 'p-2 pl-7' : 'p-1.5 pl-5'}`}
    >
      <label className="min-w-0 flex-1">
        {lg && <span className="block text-xs font-semibold">Where · what · budget</span>}
        <input
          name="q"
          defaultValue={defaultValue}
          placeholder={lg ? '3 bed apartments under $2,000' : 'Search homes and apartments'}
          aria-label="Search homes and apartments"
          className={`w-full bg-transparent outline-none placeholder:text-muted ${lg ? 'text-[15px]' : 'text-sm font-medium'}`}
        />
      </label>
      <button
        type="submit"
        aria-label="Search"
        className={`btn-brand flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold ${lg ? 'h-12 px-5 text-sm' : 'h-8 w-8'}`}
      >
        <Glass size={lg ? 16 : 14} />
        {lg && <span>Search</span>}
      </button>
    </form>
  );
}
