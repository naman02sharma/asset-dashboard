import { Wallet, CheckCircle2, CalendarClock, Truck, Wrench } from 'lucide-react';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

/**
 * Top-level KPI widgets. The first two share a signature "spend
 * meter" — a slim horizontal bar showing paid vs. remaining as a
 * proportion of total spend — so the relationship between the numbers
 * is visible at a glance, not just the raw figures.
 *
 * The last three answer a different question than the first two: not
 * "what have I spent so far" but "what will I still need to pay out"
 * — combined, then broken down into money owed on orders still in
 * transit and the cost of maintenance that's scheduled but not yet
 * done. All three come straight from purchaseController.
 * getPurchaseSummary rather than being derived here, since
 * total_remaining (still returned by that endpoint, just not shown as
 * its own card here) blends delivered and undelivered orders together
 * and can't answer "what's still coming up" on its own — see the
 * per-purchase "Overpaid ₹X" labels in AdvancePaymentEditor /
 * PurchaseTable / CompletedOrdersPage for where a since-corrected
 * overpayment still surfaces instead.
 */
export default function KpiCards({ summary }) {
  const total = Number(summary?.total_value || 0);
  const paid = Number(summary?.total_paid || 0);
  const paidPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  const pendingDeliveryOwed = Number(summary?.pending_delivery_amount_remaining || 0);
  const upcomingMaintenanceCost = Number(summary?.upcoming_maintenance_cost || 0);
  const upcomingMaintenanceCount = Number(summary?.upcoming_maintenance_count || 0);
  const futureAmountDue = pendingDeliveryOwed + upcomingMaintenanceCost;

  const cards = [
    {
      label: 'Total Asset Purchase Value',
      value: currency(total),
      icon: Wallet,
      accent: 'text-slate-900',
      iconBg: 'bg-slate-100 text-slate-600',
      meter: <SpendMeter paidPct={paidPct} />,
    },
    {
      label: 'Total Amount Paid',
      value: currency(paid),
      icon: CheckCircle2,
      accent: 'text-green-700',
      iconBg: 'bg-green-50 text-green-600',
      meter: <p className="text-xs text-slate-400 mt-3">{paidPct.toFixed(0)}% of total spend</p>,
    },
    {
      label: 'Amount To Be Paid (Future)',
      value: currency(futureAmountDue),
      icon: CalendarClock,
      accent: futureAmountDue > 0 ? 'text-red-700' : 'text-slate-900',
      iconBg: futureAmountDue > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500',
      meter: (
        <p className="text-xs text-slate-400 mt-3">
          {currency(pendingDeliveryOwed)} on deliveries · {currency(upcomingMaintenanceCost)} on maintenance
        </p>
      ),
    },
    {
      label: 'Pending Deliveries',
      value: summary?.pending_deliveries ?? 0,
      icon: Truck,
      accent: 'text-amber-700',
      iconBg: 'bg-amber-50 text-amber-600',
      meter: (
        <p className="text-xs text-slate-400 mt-3">
          {pendingDeliveryOwed > 0 ? <span className="font-medium text-amber-700">{currency(pendingDeliveryOwed)} owed</span> : 'Fully paid'} on orders not yet delivered
        </p>
      ),
      isCount: true,
    },
    {
      label: 'Upcoming Maintenance Cost',
      value: currency(upcomingMaintenanceCost),
      icon: Wrench,
      accent: upcomingMaintenanceCost > 0 ? 'text-purple-700' : 'text-slate-900',
      iconBg: 'bg-purple-50 text-purple-600',
      meter: (
        <p className="text-xs text-slate-400 mt-3">
          {upcomingMaintenanceCount > 0 ? `Across ${upcomingMaintenanceCount} scheduled visit${upcomingMaintenanceCount === 1 ? '' : 's'}` : 'Nothing scheduled'}
        </p>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="flex items-start justify-between">
            <p className="text-sm font-medium text-slate-500">{card.label}</p>
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.iconBg}`}>
              <card.icon size={16} strokeWidth={2} />
            </span>
          </div>
          <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${card.accent}`}>
            {card.isCount ? card.value : card.value}
          </p>
          {card.meter}
        </div>
      ))}
    </div>
  );
}

function SpendMeter({ paidPct }) {
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${paidPct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-slate-400">{paidPct.toFixed(0)}% paid</p>
    </div>
  );
}
