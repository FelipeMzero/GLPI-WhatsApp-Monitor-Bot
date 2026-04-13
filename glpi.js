const axios = require('axios');

class GLPIClient {
    constructor(url, appToken, userToken) {
        this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        this.baseUrl = this.baseUrl.includes('/apirest.php') ? this.baseUrl : `${this.baseUrl}/apirest.php`;
        this.appToken = appToken;
        this.userToken = userToken;
        this.sessionToken = null;
    }

    async initSession() {
        try {
            const response = await axios.get(`${this.baseUrl}/initSession`, {
                headers: {
                    'App-Token': this.appToken,
                    'Authorization': `user_token ${this.userToken}`
                }
            });
            this.sessionToken = response.data.session_token;
            console.log('GLPI Session initialized');
            return true;
        } catch (error) {
            console.error('Error initializing GLPI session:', error.response ? error.response.data : error.message);
            return false;
        }
    }

    async getTickets(criteria = []) {
        if (!this.sessionToken) await this.initSession();
        try {
            const response = await axios.get(`${this.baseUrl}/Ticket`, {
                params: {
                    range: '0-50',
                    sort: 'date_mod',
                    order: 'DESC'
                },
                headers: {
                    'App-Token': this.appToken,
                    'Session-Token': this.sessionToken
                }
            });
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 401) {
                await this.initSession();
                return this.getTickets(criteria);
            }
            console.error('Error fetching tickets:', error.message);
            return [];
        }
    }

    async getTicketDetails(ticketId) {
        if (!this.sessionToken) await this.initSession();
        try {
            const response = await axios.get(`${this.baseUrl}/Ticket/${ticketId}?expand_dropdowns=true`, {
                headers: {
                    'App-Token': this.appToken,
                    'Session-Token': this.sessionToken
                }
            });
            return response.data;
        } catch (error) {
            console.error(`Error fetching ticket ${ticketId} details:`, error.message);
            return null;
        }
    }

    async getTechnicianName(ticketId) {
        try {
            const response = await axios.get(`${this.baseUrl}/Ticket/${ticketId}/Ticket_User`, {
                headers: {
                    'App-Token': this.appToken,
                    'Session-Token': this.sessionToken
                }
            });
            const tech = response.data.find(u => u.type === 2);
            if (tech) {
                const user = await axios.get(`${this.baseUrl}/User/${tech.users_id}`, {
                    headers: {
                        'App-Token': this.appToken,
                        'Session-Token': this.sessionToken
                    }
                });
                const fullName = [user.data.firstname, user.data.realname].filter(Boolean).join(' ');
                return fullName || user.data.name || 'Técnico';
            }
            return 'Técnico não atribuído';
        } catch (e) {
            return 'Técnico';
        }
    }

    async getRequestorName(ticketId) {
        try {
            const response = await axios.get(`${this.baseUrl}/Ticket/${ticketId}/Ticket_User`, {
                headers: {
                    'App-Token': this.appToken,
                    'Session-Token': this.sessionToken
                }
            });
            const req = response.data.find(u => u.type === 1);
            if (req) {
                const user = await axios.get(`${this.baseUrl}/User/${req.users_id}`, {
                    headers: {
                        'App-Token': this.appToken,
                        'Session-Token': this.sessionToken
                    }
                });
                const fullName = [user.data.firstname, user.data.realname].filter(Boolean).join(' ');
                return fullName || user.data.name || 'Requisitante';
            }
            return 'Não identificado';
        } catch (e) {
            return 'Não identificado';
        }
    }
}

module.exports = GLPIClient;
