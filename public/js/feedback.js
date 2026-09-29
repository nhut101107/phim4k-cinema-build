const Feedback = {
  loading: false,

  formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Không rõ thời gian';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(date);
  },

  async open() {
    const modal = document.getElementById('feedbackModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    await this.load();
  },

  close() {
    document.getElementById('feedbackModal')?.classList.add('hidden');
    window.App?.syncPageScrollLock?.();
  },

  async submit(event) {
    event?.preventDefault?.();
    const category = document.getElementById('feedbackCategory')?.value || 'feedback';
    const subject = String(document.getElementById('feedbackSubject')?.value || '').trim();
    const message = String(document.getElementById('feedbackMessage')?.value || '').trim();
    const status = document.getElementById('feedbackStatus');
    const button = document.getElementById('feedbackSubmitBtn');
    if (message.length < 3) {
      status.textContent = 'Nhập nội dung cụ thể hơn một chút.';
      status.className = 'gate-message error';
      return;
    }
    button.disabled = true;
    status.textContent = 'Đang gửi đến Admin…';
    status.className = 'gate-message';
    try {
      const result = await API.request('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ category, subject, message }),
      });
      status.textContent = result.message || 'Đã gửi đến Admin.';
      status.className = 'gate-message success';
      document.getElementById('feedbackSubject').value = '';
      document.getElementById('feedbackMessage').value = '';
      await this.load();
    } catch (error) {
      status.textContent = `Không gửi được: ${error.message}`;
      status.className = 'gate-message error';
    } finally {
      button.disabled = false;
    }
  },

  async load() {
    const list = document.getElementById('feedbackThreadList');
    if (!list || this.loading) return;
    this.loading = true;
    list.textContent = 'Đang đọc phản hồi…';
    try {
      const data = await API.request('/api/feedback', { cache: 'no-store' });
      list.replaceChildren();
      const tickets = Array.isArray(data.tickets) ? data.tickets : [];
      if (!tickets.length) {
        const empty = document.createElement('p');
        empty.className = 'feedback-empty';
        empty.textContent = 'Chưa có góp ý hoặc báo lỗi nào.';
        list.appendChild(empty);
        return;
      }
      tickets.forEach((ticket) => {
        const card = document.createElement('article');
        card.className = `feedback-ticket status-${ticket.status || 'open'}`;
        const heading = document.createElement('div');
        heading.className = 'feedback-ticket-heading';
        const title = document.createElement('strong');
        title.textContent = `${ticket.category === 'issue' ? 'Báo lỗi' : 'Góp ý'} · ${ticket.subject}`;
        const state = document.createElement('span');
        state.textContent = ticket.status === 'answered' ? 'Admin đã trả lời' : ticket.status === 'closed' ? 'Đã đóng' : 'Đang chờ';
        heading.append(title, state);
        const message = document.createElement('p');
        message.textContent = ticket.message;
        const time = document.createElement('small');
        time.textContent = this.formatTime(ticket.created_at);
        card.append(heading, message, time);
        if (ticket.admin_reply) {
          const reply = document.createElement('div');
          reply.className = 'feedback-admin-reply';
          const label = document.createElement('b');
          label.textContent = 'Admin trả lời';
          const body = document.createElement('p');
          body.textContent = ticket.admin_reply;
          const replyTime = document.createElement('small');
          replyTime.textContent = this.formatTime(ticket.replied_at || ticket.updated_at);
          reply.append(label, body, replyTime);
          card.appendChild(reply);
        }
        list.appendChild(card);
      });
    } catch (error) {
      list.textContent = `Không đọc được phản hồi: ${error.message}`;
    } finally {
      this.loading = false;
    }
  },
};

function openFeedbackModal() { return Feedback.open(); }
function hideFeedbackModal() { Feedback.close(); }
function closeFeedbackModal(event) { if (event.target?.id === 'feedbackModal') Feedback.close(); }
function submitFeedback(event) { return Feedback.submit(event); }

window.Feedback = Feedback;
