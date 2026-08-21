import { ArrowLeft } from 'lucide-react';
import CompletedOrdersPage from './CompletedOrdersPage.jsx';

/**
 * "Successful Order History" — the order/financial lifecycle view
 * (what was bought, from whom, has it been paid for) of a delivered
 * purchase. Its custody/maintenance counterpart, Inventory Management
 * (who has the item now, is its AMC expiring), now lives on the Home
 * page instead of as a second tab here — but the two still track the
 * same physical items, and the backend still auto-creates the
 * matching Inventory asset the moment a purchase is marked
 * "delivered" (see trackingService.applyStatusUpdate ->
 * assetController.ensureAssetFromPurchase), so nothing has to be
 * re-entered by hand once an order actually lands.
 */
export default function AssetLifecyclePage({ vendors, locations, onBack, showToast, initialQuery = '', onModifyAdvancePayment, onRecordDelivery, onEditPurchase, onSummaryChange, onGoToAsset }) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} title="Back to dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105 transition-all">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Order History</h2>
          <p className="text-sm text-slate-500">Delivered purchases automatically flow into Inventory Management on the Home page.</p>
        </div>
      </div>

      <CompletedOrdersPage vendors={vendors} locations={locations} showToast={showToast} embedded initialQuery={initialQuery}
        onModifyAdvancePayment={onModifyAdvancePayment} onRecordDelivery={onRecordDelivery}
        onEditPurchase={onEditPurchase} onSummaryChange={onSummaryChange} onGoToAsset={onGoToAsset} />
    </div>
  );
}
