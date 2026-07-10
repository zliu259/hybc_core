import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { useElementPlus } from "@/plugins/elementPlus";
import SplitEnvelopeDialog from "./SplitEnvelopeDialog.vue";
import type {
  EnvelopeAttachment,
  ReimbursementEnvelopeDetail
} from "@/api/reimbursement";

// Regression coverage for the production incident where checking attachments
// in the split dialog silently got cleared before the user finished filling
// in the rest of the form. Root cause: the detail page polls audit status
// every few seconds while this dialog is open and replaces `detail` with a
// brand-new object; the table used to bind straight to a computed derived
// from that prop, so Element Plus saw a new `:data` array reference on every
// poll tick and cleared the table's selection. See detail.vue's
// clearAuditPolling/ensureAuditPolling watch on splitDialogVisible, and this
// component's attachmentSnapshot ref, for the fix.

const splitReimbursementEnvelopeMock = vi.fn();
const confirmMock = vi.fn();
const messageMock = vi.fn();

// Note: deliberately not using vi.importActual here. The real module pulls
// in @/utils/http -> router/store setup that isn't initialized in the unit
// test environment (see getHistoryMode in router/utils.ts, which reads a
// Vite env var only defined for the real app boot). This component only
// uses `splitReimbursementEnvelope` at runtime -- everything else imported
// from this module is type-only and erased at build time -- so a full
// replacement is all that's needed.
vi.mock("@/api/reimbursement", () => ({
  splitReimbursementEnvelope: (...args: unknown[]) =>
    splitReimbursementEnvelopeMock(...args)
}));

vi.mock("@/composables/useProjectOptions", async () => {
  const { ref } = await import("vue");
  return {
    useProjectOptions: () => ({
      projects: ref([{ id: 1, project_name: "示例项目" }]),
      loadProjects: vi.fn().mockResolvedValue(undefined)
    })
  };
});

vi.mock("@/utils/message", () => ({
  message: (...args: unknown[]) => messageMock(...args)
}));

vi.mock("element-plus", async () => {
  const actual =
    await vi.importActual<typeof import("element-plus")>("element-plus");
  return {
    ...actual,
    ElMessageBox: {
      ...actual.ElMessageBox,
      confirm: (...args: unknown[]) => confirmMock(...args)
    }
  };
});

const buildAttachment = (
  overrides: Partial<EnvelopeAttachment> = {}
): EnvelopeAttachment => ({
  id: 1,
  envelope_id: 100,
  attachment_type: "invoice",
  file_key: "key-1",
  file_name: "发票1.pdf",
  file_size: 1024,
  invoice_no: null,
  amount: null,
  issue_date: null,
  status: "active",
  created_at: "2026-07-01T00:00:00Z",
  ...overrides
});

const buildDetail = (
  overrides: Partial<ReimbursementEnvelopeDetail> = {}
): ReimbursementEnvelopeDetail => ({
  id: 100,
  envelope_no: "BX-20260701-0001",
  envelope_uuid: "uuid-1",
  project_id: 1,
  applicant_userid: "u1",
  channel: "electronic",
  invoice_unique_no: null,
  invoice_no: null,
  expense_date: "2026-07-01",
  amount: 1000,
  category: "交通费",
  description: "",
  status: "received",
  precheck_status: "pending",
  verification_status: "pending",
  ocr_status: "running",
  duplicate_check_status: "running",
  pdf_status: "none",
  pdf_task_id: null,
  pdf_file_key: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  attachments: [buildAttachment()],
  duplicate_checks: [],
  batch: null,
  ...overrides
});

const mountDialog = async (detail: ReimbursementEnvelopeDetail) => {
  const wrapper = mount(SplitEnvelopeDialog, {
    props: {
      visible: false,
      detail
    },
    global: {
      plugins: [useElementPlus]
    }
  });
  // Real usage never mounts with visible already true; the parent flips
  // splitDialogVisible from false -> true on click, which is what fires the
  // dialog's `watch(() => props.visible, ...)` that populates the
  // attachment snapshot. Mirror that here rather than mounting pre-opened.
  await wrapper.setProps({ visible: true });
  await flushPromises();
  return wrapper;
};

// ElTable exposes selection helpers on its public instance (toggleRowSelection,
// getSelectionRows, clearSelection -- see element-plus table.vue2.mjs) that
// aren't part of @vue/test-utils' generic ComponentPublicInstance typing.
// Narrow through `unknown` rather than `any` to call them without losing type
// safety on the rest of the test.
interface ElTableSelectionApi {
  toggleRowSelection: (row: EnvelopeAttachment, selected?: boolean) => void;
  getSelectionRows: () => EnvelopeAttachment[];
}

const findTable = (wrapper: VueWrapper) =>
  wrapper.findComponent({ name: "ElTable" });

const tableSelectionApi = (wrapper: VueWrapper): ElTableSelectionApi =>
  findTable(wrapper).vm as unknown as ElTableSelectionApi;

// The dialog's footer is rendered by ElDialog through a Teleport to
// document.body, so plain DOM queries scoped to `wrapper.element` (e.g.
// `wrapper.find('button...')`) can't see it -- it physically lives outside
// the wrapper's own root subtree. Finding the component instance directly
// (which VTU tracks via the virtual DOM, independent of where Teleport
// physically moves the real node) and triggering on it works regardless.
const findSubmitButton = (wrapper: VueWrapper) => {
  const button = wrapper
    .findAllComponents({ name: "ElButton" })
    .find(candidate => candidate.text() === "确认拆单");
  if (!button) throw new Error("submit button not found");
  return button;
};

beforeEach(() => {
  splitReimbursementEnvelopeMock.mockReset();
  confirmMock.mockReset();
  messageMock.mockReset();
});

describe("SplitEnvelopeDialog", () => {
  it("keeps a checked attachment selected after the parent replaces `detail` with a new object (audit-poll refresh)", async () => {
    const attachment = buildAttachment({ id: 42 });
    const initialDetail = buildDetail({ attachments: [attachment] });
    const wrapper = await mountDialog(initialDetail);

    const table = findTable(wrapper);
    const tableDataBefore = table.props("data");
    const tableApi = tableSelectionApi(wrapper);

    // Simulate the user checking the attachment in the table.
    tableApi.toggleRowSelection(attachment, true);
    await flushPromises();
    expect(tableApi.getSelectionRows()).toEqual([attachment]);

    // Simulate the detail page's background audit-status poll: it replaces
    // `detail` with an entirely new object (new attachments array too) every
    // ~3s while this dialog stays open, without the user having submitted.
    await wrapper.setProps({
      detail: buildDetail({
        attachments: [buildAttachment({ id: 42 })],
        ocr_status: "done"
      })
    });
    await flushPromises();

    // The table's bound data array must be the same snapshot reference as
    // before the prop swap -- this is what stops Element Plus from wiping
    // the selection (dataInstanceChanged check in its selection store).
    expect(table.props("data")).toBe(tableDataBefore);
    expect(tableApi.getSelectionRows()).toEqual([attachment]);
  });

  it("shows a confirm dialog before submitting with zero attachments selected, and aborts the submit if the user cancels", async () => {
    const wrapper = await mountDialog(buildDetail());

    const projectSelect = wrapper.findComponent({ name: "ElSelect" });
    await projectSelect.vm.$emit("update:modelValue", 1);
    const amountInput = wrapper.findComponent({ name: "ElInputNumber" });
    await amountInput.vm.$emit("update:modelValue", 400);
    await flushPromises();

    confirmMock.mockRejectedValueOnce("cancel");

    await findSubmitButton(wrapper).trigger("click");
    await flushPromises();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(splitReimbursementEnvelopeMock).not.toHaveBeenCalled();
  });

  it("submits with an empty attachment_ids array once the user confirms the zero-selection warning", async () => {
    const wrapper = await mountDialog(buildDetail());

    const projectSelect = wrapper.findComponent({ name: "ElSelect" });
    await projectSelect.vm.$emit("update:modelValue", 1);
    const amountInput = wrapper.findComponent({ name: "ElInputNumber" });
    await amountInput.vm.$emit("update:modelValue", 400);
    await flushPromises();

    confirmMock.mockResolvedValueOnce(undefined);
    splitReimbursementEnvelopeMock.mockResolvedValueOnce({
      data: {
        new_envelope: {
          id: 2,
          envelope_no: "BX-20260701-0002",
          envelope_uuid: "uuid-2"
        },
        original_envelope: { id: 100, envelope_no: "BX-20260701-0001" }
      }
    });

    await findSubmitButton(wrapper).trigger("click");
    await flushPromises();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(splitReimbursementEnvelopeMock).toHaveBeenCalledTimes(1);
    const [, payload] = splitReimbursementEnvelopeMock.mock.calls[0];
    expect(payload.attachment_ids).toEqual([]);
  });
});
