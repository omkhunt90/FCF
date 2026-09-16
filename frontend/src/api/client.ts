import axios from 'axios';
import type { AxiosInstance, AxiosError } from 'axios';
import type { ApiResponse } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Attach access token to every request
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle 401 — try refresh, then redirect to login (if not already on login page)
    this.client.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        const originalRequest = error.config as typeof error.config & { _retry?: boolean };
        const isAuthEndpoint = originalRequest?.url?.includes('/auth/login') || originalRequest?.url?.includes('/auth/refresh');
        if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
          originalRequest._retry = true;
          const refreshToken = localStorage.getItem('refreshToken');
          if (refreshToken) {
            try {
              const res = await axios.post<ApiResponse<{ accessToken: string }>>(
                `${BASE_URL}/auth/refresh`,
                { refreshToken }
              );
              const newToken = res.data.data?.accessToken;
              if (newToken) {
                localStorage.setItem('accessToken', newToken);
                this.client.defaults.headers.common.Authorization = `Bearer ${newToken}`;
                return this.client(originalRequest);
              }
            } catch {
              // Refresh failed — clear tokens and redirect
              localStorage.removeItem('accessToken');
              localStorage.removeItem('refreshToken');
              if (window.location.pathname !== '/login') {
                window.location.href = '/login';
              }
            }
          } else {
            if (window.location.pathname !== '/login') {
              window.location.href = '/login';
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth
  async login(username: string, password: string) {
    const res = await this.client.post<ApiResponse<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; username: string; role: string; participantId?: string; displayName?: string };
    }>>('/auth/login', { username, password });
    return res.data;
  }

  async refreshToken(refreshToken: string) {
    const res = await this.client.post<ApiResponse<{ accessToken: string }>>(
      '/auth/refresh', { refreshToken }
    );
    return res.data;
  }

  async logout(refreshToken?: string) {
    const res = await this.client.post('/auth/logout', { refreshToken });
    return res.data;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const res = await this.client.post('/auth/change-password', { currentPassword, newPassword });
    return res.data;
  }

  // Competition
  async getCompetition() {
    const res = await this.client.get('/competition');
    return res.data;
  }

  async startCompetition(competitionId: string) {
    const res = await this.client.post('/competition/start', { competitionId });
    return res.data;
  }

  async startRound(roundId: string) {
    const res = await this.client.post(`/competition/rounds/${roundId}/start`);
    return res.data;
  }

  async endRound(roundId: string) {
    const res = await this.client.post(`/competition/rounds/${roundId}/end`);
    return res.data;
  }

  async pauseRound(roundId: string) {
    const res = await this.client.post(`/competition/rounds/${roundId}/pause`);
    return res.data;
  }

  async resumeRound(roundId: string) {
    const res = await this.client.post(`/competition/rounds/${roundId}/resume`);
    return res.data;
  }

  async setActiveActivity(roundId: string, activityId: string) {
    const res = await this.client.put(`/competition/rounds/${roundId}/activity`, { activityId });
    return res.data;
  }

  async getRoundStatus(roundId: string) {
    const res = await this.client.get(`/competition/rounds/${roundId}/status`);
    return res.data;
  }

  async patchActivity(activityId: string, data: { type?: string; name?: string; durationMs?: number }) {
    const res = await this.client.patch(`/competition/activities/${activityId}`, data);
    return res.data;
  }

  async setupRound2() {
    const res = await this.client.post('/competition/setup-round2');
    return res.data;
  }

  // Tasks
  async getTasksForActivity(activityId: string) {
    const res = await this.client.get(`/tasks?activityId=${activityId}`);
    return res.data;
  }

  async createTask(data: object) {
    const res = await this.client.post('/tasks', data);
    return res.data;
  }

  async updateTask(taskId: string, data: object) {
    const res = await this.client.put(`/tasks/${taskId}`, data);
    return res.data;
  }

  async deleteTask(taskId: string) {
    const res = await this.client.delete(`/tasks/${taskId}`);
    return res.data;
  }

  async getTaskAdmin(taskId: string) {
    const res = await this.client.get(`/tasks/${taskId}/admin`);
    return res.data;
  }

  // Submissions
  async submit(data: { roundId: string; taskId: string; sourceCode: string; isRunOnly?: boolean }) {
    const res = await this.client.post('/submissions', data);
    return res.data;
  }

  async getMySubmissions(roundId?: string) {
    const params = roundId ? `?roundId=${roundId}` : '';
    const res = await this.client.get(`/submissions/mine${params}`);
    return res.data;
  }

  async getAllSubmissions(roundId?: string) {
    const params = roundId ? `?roundId=${roundId}` : '';
    const res = await this.client.get(`/submissions${params}`);
    return res.data;
  }

  async getSubmissionAdmin(submissionId: string) {
    const res = await this.client.get(`/submissions/${submissionId}`);
    return res.data;
  }

  async getDebugResult(submissionId: string) {
    const res = await this.client.get(`/submissions/${submissionId}/debug-result`);
    return res.data;
  }

  // Participants
  async getParticipants() {
    const res = await this.client.get('/participants');
    return res.data;
  }

  async createParticipant(data: { username: string; password: string; displayName: string; teamName?: string }) {
    const res = await this.client.post('/participants', data);
    return res.data;
  }

  async getParticipant(id: string) {
    const res = await this.client.get(`/participants/${id}`);
    return res.data;
  }

  async disableParticipant(id: string) {
    const res = await this.client.post(`/participants/${id}/disable`);
    return res.data;
  }

  async enableParticipant(id: string) {
    const res = await this.client.post(`/participants/${id}/enable`);
    return res.data;
  }

  async deleteParticipant(id: string) {
    const res = await this.client.delete(`/participants/${id}`);
    return res.data;
  }

  async assignQuestionBank(id: string, bank: number | null) {
    const res = await this.client.put(`/participants/${id}/question-bank`, { bank });
    return res.data;
  }

  async getParticipantAuditEvents(id: string) {
    const res = await this.client.get(`/participants/${id}/audit-events`);
    return res.data;
  }

  // Leaderboard
  async getLeaderboard() {
    const res = await this.client.get('/leaderboard');
    return res.data;
  }

  async getRoundLeaderboard(roundId: string) {
    const res = await this.client.get(`/leaderboard/round/${roundId}`);
    return res.data;
  }

  async getActivityLeaderboard(activityId: string) {
    const res = await this.client.get(`/leaderboard/activity/${activityId}`);
    return res.data;
  }


  // Admin
  async getAdminDashboard() {
    const res = await this.client.get('/admin/dashboard');
    return res.data;
  }

  async getAuditEvents() {
    const res = await this.client.get('/admin/audit-events');
    return res.data;
  }

  async createCompetition(name: string) {
    const res = await this.client.post('/admin/competition', { name });
    return res.data;
  }

  async resetCompetition() {
    const res = await this.client.post('/competition/reset');
    return res.data;
  }

  // Activity Sessions
  async startActivity(activityId: string) {
    const res = await this.client.post(`/activity-sessions/${activityId}/start`);
    return res.data;
  }

  async getMyActivitySessions() {
    const res = await this.client.get('/activity-sessions/mine');
    return res.data;
  }

  // Round 3 powers
  async setupRound3() {
    const res = await this.client.post('/competition/setup-round3');
    return res.data;
  }

  async applyRound3Power(participantId: string, power: 'freeze' | 'time-warp' | 'turbo-boost') {
    const res = await this.client.post(`/round3/power/${participantId}/${power}`);
    return res.data;
  }

  async getRound3Participants() {
    const res = await this.client.get('/round3/participants');
    return res.data;
  }

  async getMyRound3Status() {
    const res = await this.client.get('/round3/my-status');
    return res.data;
  }
}

export const api = new ApiClient();
