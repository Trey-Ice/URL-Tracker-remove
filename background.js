// Background script for intercepting redirect trackers
// Prevents Gmail/other services from wrapping links

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    // Check if this is a redirect tracker URL
    const url = details.url;
    
    // AWS tracking redirect
    if (url.includes('.awstrack.me')) {
      const realUrl = extractFromAwsTracker(url);
      if (realUrl) {
        return { redirectUrl: realUrl };
      }
    }
    
    // Generic redirect trackers
    if (isRedirectTracker(url)) {
      const realUrl = extractRealUrl(url);
      if (realUrl) {
        return { redirectUrl: realUrl };
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

function isRedirectTracker(url) {
  const trackerPatterns = [
    /\.awstrack\.me/,
    /\btrack\./,
    /\bclick\./,
    /\bredirect\./,
  ];
  
  return trackerPatterns.some(pattern => pattern.test(url));
}

function extractFromAwsTracker(url) {
  try {
    // AWS format: https://xxxxx.r.region.awstrack.me/L0/[ENCODED_URL]/1/...
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    
    if (pathParts.length > 3 && pathParts[3]) {
      try {
        const decodedUrl = decodeURIComponent(pathParts[3]);
        if (isValidUrl(decodedUrl)) {
          return decodedUrl;
        }
      } catch (e) {
        // Try without decoding
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

function extractRealUrl(url) {
  try {
    const urlObj = new URL(url);
    const possibleParams = ['url', 'redirect', 'destination', 'link', 'target'];
    
    for (const param of possibleParams) {
      const value = urlObj.searchParams.get(param);
      if (value && isValidUrl(value)) {
        try {
          return decodeURIComponent(value);
        } catch (e) {
          return value;
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}