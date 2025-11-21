
export function createWeatherService() {
    const LAT = 44.37;
    const LON = -79.69;
    const API_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=1`;

    function fetchWeather() {
        return fetch(API_URL)
            .then(res => {
                if (!res.ok) throw new Error('Weather fetch failed');
                return res.json();
            })
            .then(data => {
                const current = {
                    temp: Math.round(data.current.temperature_2m),
                    code: data.current.weather_code
                };

                const hourly = data.hourly || {};
                const forecast = [];

                // Find next 3 hours
                const now = new Date();
                const currentHourIndex = now.getHours();

                // Open-Meteo hourly data starts at 00:00 today
                // We want the next 3 hours (e.g., if it's 2pm, we want 3pm, 4pm, 5pm)
                for (let i = 1; i <= 3; i++) {
                    const targetIndex = currentHourIndex + i;
                    if (hourly.time && hourly.time[targetIndex]) {
                        forecast.push({
                            time: new Date(hourly.time[targetIndex]),
                            temp: Math.round(hourly.temperature_2m[targetIndex]),
                            code: hourly.weather_code[targetIndex]
                        });
                    }
                }

                return { current, forecast };
            });
    }

    function getWeatherIcon(code) {
        // WMO Weather interpretation codes (WW)
        // 0: Clear sky
        // 1, 2, 3: Mainly clear, partly cloudy, and overcast
        // 45, 48: Fog and depositing rime fog
        // 51, 53, 55: Drizzle: Light, moderate, and dense intensity
        // 56, 57: Freezing Drizzle: Light and dense intensity
        // 61, 63, 65: Rain: Slight, moderate and heavy intensity
        // 66, 67: Freezing Rain: Light and heavy intensity
        // 71, 73, 75: Snow fall: Slight, moderate, and heavy intensity
        // 77: Snow grains
        // 80, 81, 82: Rain showers: Slight, moderate, and violent
        // 85, 86: Snow showers slight and heavy
        // 95 *: Thunderstorm: Slight or moderate
        // 96, 99 *: Thunderstorm with slight and heavy hail

        if (code === 0) return '☀️';
        if (code >= 1 && code <= 3) return '⛅';
        if (code >= 45 && code <= 48) return '🌫️';
        if (code >= 51 && code <= 67) return '🌧️';
        if (code >= 71 && code <= 77) return '❄️';
        if (code >= 80 && code <= 82) return '🌦️';
        if (code >= 85 && code <= 86) return '🌨️';
        if (code >= 95) return '⚡';
        return '🌡️';
    }

    return {
        fetchWeather,
        getWeatherIcon
    };
}
