const normalizeDate = (dateStr) => {
  if (!dateStr) return null;
  
  const str = String(dateStr).trim().toLowerCase();
  if (str === "") return null;

  const now = new Date();

  try {
      if (
        str.includes("today") || 
        str.includes("just now") || 
        str.includes("moments ago") || 
        str.includes("hours ago") || 
        str.includes("mins ago") || 
        str.includes("minute") ||
        str.includes("seconds ago")
      ) {
        return now;
      }
      
      if (str.includes("yesterday")) {
        now.setDate(now.getDate() - 1);
        return now;
      }
      
      if (str === "last week") {
        now.setDate(now.getDate() - 7);
        return now;
      }
      
      if (str === "last month") {
        now.setMonth(now.getMonth() - 1);
        return now;
      }

      const daysMatch = str.match(/(\d+)\+?\s*days?\s*ago/);
      if (daysMatch) {
        now.setDate(now.getDate() - parseInt(daysMatch[1], 10));
        return now;
      }
      
      const weeksMatch = str.match(/(\d+)\+?\s*weeks?\s*ago/);
      if (weeksMatch) {
        now.setDate(now.getDate() - (parseInt(weeksMatch[1], 10) * 7));
        return now;
      }
      
      const monthsMatch = str.match(/(\d+)\+?\s*months?\s*ago/);
      if (monthsMatch) {
        now.setMonth(now.getMonth() - parseInt(monthsMatch[1], 10));
        return now;
      }

      const euDateMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (euDateMatch) {
        const [ , day, month, year ] = euDateMatch;
        const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
        if (!isNaN(date.getTime())) return date;
      }

      const noYearMatch = str.match(/^[a-z]{3,9}\s+\d{1,2}$|^\d{1,2}\s+[a-z]{3,9}$/i);
      if (noYearMatch) {
         const date = new Date(`${str} ${now.getFullYear()}`);
         if (!isNaN(date.getTime())) {
             if (date > now) {
                 date.setFullYear(date.getFullYear() - 1);
             }
             return date;
         }
      }

      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) return parsed;
  } catch(e) {
      console.warn(`[dateNormalizer] Failed to parse: "${dateStr}" - ${e.message}`);
  }

  return null;
};

module.exports = { normalizeDate };
