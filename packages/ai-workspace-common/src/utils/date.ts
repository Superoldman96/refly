/**
 * 格式化日期字符串
 * @param dateString 日期字符串
 * @returns 格式化后的日期字符串，格式为 YYYY-MM-DD HH:mm
 */
export function formatDate(dateString: string): string {
  if (!dateString) return '-';

  try {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
      return dateString;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch (error) {
    console.error('日期格式化错误:', error);
    return dateString;
  }
}
