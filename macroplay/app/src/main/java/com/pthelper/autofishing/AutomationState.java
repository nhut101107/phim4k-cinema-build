package com.pthelper.autofishing;

/* JADX INFO: loaded from: classes2.dex */
public enum AutomationState {
    IDLE("Đang dừng"),
    ARMED("Sẵn sàng — vào game bấm Bắt đầu"),
    PREPARING("Đang chuẩn bị"),
    CASTING("Đang thả câu"),
    WAITING_BITE("Đang chờ cá cắn"),
    HOOKING("Cá cắn - đang giật cần"),
    SKIPPING("Bỏ qua cá nhỏ"),
    PROBING("Đang tự dò nút Câu"),
    WAITING_BUG("Đang chờ côn trùng đến gần"),
    SWINGING("Vung vợt bắt côn trùng"),
    PATROLLING("Đi tìm côn trùng"),
    STORING("Đang bấm Bảo quản"),
    CHECKING_BAG("Đang kiểm tra balo"),
    REPAIRING("Đang sửa cần"),
    NAVIGATING_SELLER("Đang đến nơi bán cá"),
    SELLING("Đang bán cá"),
    RETURNING("Đang quay lại điểm câu"),
    VERIFYING_SPOT("Đang xác nhận đã về chỗ câu"),
    RECOVERING("Đang tự phục hồi"),
    LOW_BATTERY("Pin yếu — đã dừng an toàn"),
    MICRO_PAUSE("Đang nghỉ ngắn"),
    SESSION_BREAK("Đang nghỉ giữa phiên"),
    SESSION_EXPIRED("Hết phiên — tự dừng an toàn"),
    PAUSED("Đã tạm dừng"),
    ERROR("Đã dừng an toàn do lỗi");

    public final String label;

    AutomationState(String label) {
        this.label = label;
    }
}
