import { useState } from 'react';
import { ArrowLeft, PackageCheck, Boxes } from 'lucide-react';
import CompletedOrdersPage from './CompletedOrdersPage.jsx';
import InventoryPage from './InventoryPage.jsx';

/**
 * "Successful Order History" and "Inventory Management" track the
 * same physical items from two different angles — order/financial
 * lifecycle (what was bought, from whom, has it been paid for) vs.
 * custody/maintenance lifecycle (who has it now, is its AMC expiring).
 * Rather than merging the two data models (which would break the
 * maintenance-scheduling and employee-assignment flows each depends
 * on), this single page presents both as tabs, and the backend now
 * auto-creates the matching Inventory asset the moment a purchase is
 * marked "delivered" (see trackingService.applyStatusUpdate ->
 * assetController.ensureAssetFromPurchase) — so nothing has to be
 * re-entered by hand once an order actually lands.
 */
export default function AssetLifecyclePage({ vendors, onBack, showToast, initialTab = 'history', initialQuery = '', onModifyAdvancePayment, onRecordDelivery, onSummaryChange }) {
  const [tab, setTab] = useState(initialTab); // 'history' | 'inventory'

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} title="Back to dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Assets &amp; Order History</h2>
          <p className="text-sm text-slate-500">Delivered purchases automatically flow into Inventory below.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={PackageCheck}>
          Order History
        </TabButton>
        <TabButton active={tab === 'inventory'} onClick={() => setTab('inventory')} icon={Boxes}>
          Inventory Management
        </TabButton>
      </div>

      {tab === 'history' ? (
        <CompletedOrdersPage vendors={vendors} showToast={showToast} embedded initialQuery={initialQuery}
          onModifyAdvancePayment={onModifyAdvancePayment} onRecordDelivery={onRecordDelivery} onSummaryChange={onSummaryChange} />
      ) : (
        <InventoryPage vendors={vendors} showToast={showToast} embedded initialQuery={initialQuery} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
        active ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      <Icon size={15} /> {children}
    </button>
  );
}
